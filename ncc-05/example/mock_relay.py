import asyncio
import json
import websockets

from typing import List, Dict, Any

# Simple in-memory storage for events
events: List[Dict[str, Any]] = []


async def handle_nostr(websocket):
    async for message in websocket:
        msg = json.loads(message)
        cmd = msg[0]
        print(f"[Relay] Received: {cmd}")

        if cmd == "EVENT":
            event = msg[1]
            print(f"[Relay] Storing event kind {event['kind']} "
                  f"from {event['pubkey'][:8]}")
            # Replaceable event logic (Kind 30058 / 10002)
            if 30000 <= event['kind'] < 40000 or event['kind'] == 10002:
                d_tag = next((t[1] for t in event['tags'] if t[0] == 'd'), "")
                global events
                events = [e for e in events if not (
                    e['pubkey'] == event['pubkey'] and
                    e['kind'] == event['kind'] and
                    next((t[1] for t in e['tags'] if t[0] == 'd'), "") == d_tag
                )]

            events.append(event)
            await websocket.send(json.dumps(["OK", event['id'], True, ""]))

        elif cmd == "REQ":
            subscription_id = msg[1]
            filters = msg[2]
            print(f"[Relay] Subscription {subscription_id} filters: {filters}")

            # Simple filter matching
            count = 0
            for event in events:
                match = True
                if "authors" in filters and \
                   event['pubkey'] not in filters['authors']:
                    match = False
                if "kinds" in filters and \
                   event['kind'] not in filters['kinds']:
                    match = False
                if "#d" in filters:
                    d_tag = next((t[1] for t in event['tags']
                                 if t[0] == 'd'), None)
                    if d_tag not in filters['#d']:
                        match = False

                if match:
                    print(f"[Relay] Match found: kind {event['kind']}")
                    await websocket.send(json.dumps(
                        ["EVENT", subscription_id, event]
                    ))
                    count += 1

            print(f"[Relay] Sent {count} events to {subscription_id}")
            await websocket.send(json.dumps(["EOSE", subscription_id]))


async def main():
    print("Mock Nostr Relay starting on ws://localhost:8080")
    async with websockets.serve(handle_nostr, "localhost", 8080):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
