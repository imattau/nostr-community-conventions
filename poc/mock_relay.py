from typing import List, Dict, Optional
try:
    from .models import NostrEvent
except ImportError:
    from models import NostrEvent


class MockRelay:
    def __init__(self):
        # Store replaceable events by kind:pubkey:d_tag
        self.replaceable: Dict[str, NostrEvent] = {}
        # Store all events by ID for reference
        self.all_events: Dict[str, NostrEvent] = {}

    def publish(self, event: NostrEvent):
        if not event.verify():
            raise ValueError("Invalid event signature")

        self.all_events[event.id] = event

        # Determine if it's a parameterized replaceable event
        d_tag = None
        for tag in event.tags:
            if tag[0] == 'd':
                d_tag = tag[1]
                break

        if d_tag is not None:
            key = f"{event.kind}:{event.pubkey}:{d_tag}"
            if key in self.replaceable:
                if event.created_at > self.replaceable[key].created_at:
                    self.replaceable[key] = event
            else:
                self.replaceable[key] = event

    def query(self,
              pubkey: Optional[str] = None,
              kind: Optional[int] = None,
              d_tag: Optional[str] = None) -> List[NostrEvent]:
        if d_tag is not None and pubkey is not None and kind is not None:
            key = f"{kind}:{pubkey}:{d_tag}"
            return [self.replaceable[key]] if key in self.replaceable else []

        results = list(self.all_events.values())
        if pubkey:
            results = [e for e in results if e.pubkey == pubkey]
        if kind:
            results = [e for e in results if e.kind == kind]
        return results

    def get_by_id(self, event_id: str) -> Optional[NostrEvent]:
        return self.all_events.get(event_id)