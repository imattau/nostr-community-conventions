import json
import time
import hashlib
from typing import List, Optional


class NostrEvent:
    def __init__(self,
                 pubkey: str,
                 kind: int,
                 content: str,
                 tags: List[List[str]],
                 created_at: Optional[int] = None):
        self.pubkey = pubkey
        self.kind = kind
        self.content = content
        self.tags = tags
        self.created_at = created_at or int(time.time())
        self.id = self._calculate_id()
        self.sig = None

    def _calculate_id(self) -> str:
        # Simplified ID calculation for PoC
        # In real Nostr, this is SHA256 of [0, pubkey, created_at, kind, tags,
        # content]
        data = [0, self.pubkey, self.created_at, self.kind, self.tags,
                self.content]
        return hashlib.sha256(
            json.dumps(data, separators=(',', ':')).encode()
        ).hexdigest()

    def sign(self, private_key: str):
        # Mock signing for PoC to avoid complexity of real Schnorr signatures
        # unless we use a library. Since pynostr is available, we can use it.
        from pynostr.event import Event
        event = Event(
            content=self.content,
            pubkey=self.pubkey,
            created_at=self.created_at,
            kind=self.kind,
            tags=self.tags
        )
        event.sign(private_key)
        self.id = event.id
        self.sig = event.sig

    def verify(self) -> bool:
        from pynostr.event import Event
        event = Event(
            content=self.content,
            pubkey=self.pubkey,
            created_at=self.created_at,
            kind=self.kind,
            tags=self.tags,
            id=self.id,
            sig=self.sig
        )
        return event.verify()

    def to_dict(self):
        return {
            "id": self.id,
            "pubkey": self.pubkey,
            "created_at": self.created_at,
            "kind": self.kind,
            "tags": self.tags,
            "content": self.content,
            "sig": self.sig
        }
