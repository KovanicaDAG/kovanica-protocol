//! Bounded in-memory chat store (ring buffer).
//!
//! `ChatStore` keeps at most `capacity` messages in a `VecDeque`. When full,
//! the oldest message is evicted. Memory usage is O(capacity) with no I/O.

use crate::message::ChatMessage;

/// Default ring-buffer capacity.
pub const DEFAULT_CAPACITY: usize = 1000;

/// A bounded in-memory chat store.
#[derive(Clone, Debug)]
pub struct ChatStore {
    messages: std::collections::VecDeque<ChatMessage>,
    capacity: usize,
}

impl ChatStore {
    /// Create a new store with the given capacity.
    ///
    /// # Panics
    /// Panics if `capacity` is zero.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "capacity must be > 0");
        Self {
            messages: std::collections::VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    /// Push a message, evicting the oldest if at capacity.
    pub fn push(&mut self, msg: ChatMessage) {
        if self.messages.len() >= self.capacity {
            self.messages.pop_front();
        }
        self.messages.push_back(msg);
    }

    /// Iterate messages oldest-first.
    pub fn iter(&self) -> impl Iterator<Item = &ChatMessage> {
        self.messages.iter()
    }

    /// Number of messages currently stored.
    pub fn len(&self) -> usize {
        self.messages.len()
    }

    /// Whether the store is empty.
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }

    /// Clear all messages.
    pub fn clear(&mut self) {
        self.messages.clear();
    }

    /// Return messages involving `pubkey` (as sender or recipient), oldest-first.
    pub fn messages_for<'a>(
        &'a self,
        pubkey: &'a [u8; 32],
    ) -> impl Iterator<Item = &'a ChatMessage> + 'a {
        self.messages
            .iter()
            .filter(move |m| &m.sender == pubkey || &m.recipient == pubkey)
    }
}

impl Default for ChatStore {
    fn default() -> Self {
        Self::new(DEFAULT_CAPACITY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(sender: u8, text: &str) -> ChatMessage {
        ChatMessage::new([sender; 32], [255u8; 32], text.to_string(), 0)
    }

    #[test]
    fn push_and_iter() {
        let mut store = ChatStore::new(3);
        store.push(msg(1, "a"));
        store.push(msg(2, "b"));
        assert_eq!(store.len(), 2);
        let texts: Vec<_> = store.iter().map(|m| m.plaintext.as_str()).collect();
        assert_eq!(texts, vec!["a", "b"]);
    }

    #[test]
    fn evicts_oldest_when_full() {
        let mut store = ChatStore::new(2);
        store.push(msg(1, "first"));
        store.push(msg(2, "second"));
        store.push(msg(3, "third"));
        assert_eq!(store.len(), 2);
        let texts: Vec<_> = store.iter().map(|m| m.plaintext.as_str()).collect();
        assert_eq!(texts, vec!["second", "third"]);
    }

    #[test]
    fn messages_for_filters() {
        let mut store = ChatStore::new(10);
        store.push(msg(1, "to 2"));
        store.push(msg(2, "to 1"));
        store.push(msg(3, "to 4"));
        let pk1 = [1u8; 32];
        // Only the first message has sender = [1;32]
        let count = store.messages_for(&pk1).count();
        assert_eq!(count, 1);
    }

    #[test]
    fn clear_empties() {
        let mut store = ChatStore::new(5);
        store.push(msg(1, "x"));
        store.clear();
        assert!(store.is_empty());
    }
}
