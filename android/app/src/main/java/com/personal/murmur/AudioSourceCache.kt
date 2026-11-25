package com.personal.murmur

class AudioSourceCache<T>(private val capacity: Int = 12, private val lifetimeMs: Long = 300_000, private val now: () -> Long = { System.currentTimeMillis() }) {
    private data class Entry<T>(val at: Long, val value: T)
    private val entries = LinkedHashMap<String, Entry<T>>(16, .75f, true)
    @Synchronized fun get(key: String): T? {
        val entry = entries[key] ?: return null
        if (now() - entry.at >= lifetimeMs) { entries.remove(key); return null }
        return entry.value
    }
    @Synchronized fun put(key: String, value: T) {
        entries[key] = Entry(now(), value)
        while (entries.size > capacity) entries.remove(entries.keys.first())
    }
    @Synchronized fun remove(key: String) { entries.remove(key) }
    @Synchronized fun clear() = entries.clear()
}
