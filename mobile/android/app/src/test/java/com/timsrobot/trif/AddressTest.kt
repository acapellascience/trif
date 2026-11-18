package com.timsrobot.trif

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AddressTest {
    @Test fun empty() {
        assertNull(Address.resolve("   "))
    }

    @Test fun addresses() {
        assertEquals("https://x.com", Address.resolve("x.com"))
        assertEquals("https://x.com/home?a=1", Address.resolve("  x.com/home?a=1 "))
        assertEquals("http://localhost:8477/plain.html", Address.resolve("localhost:8477/plain.html"))
        assertEquals("http://app.localhost", Address.resolve("app.localhost"))
        assertEquals("https://127.0.0.1:8477", Address.resolve("127.0.0.1:8477"))
        assertEquals("https://[::1]:80/", Address.resolve("[::1]:80/"))
        assertEquals("http://example.com", Address.resolve("http://example.com"))
        assertEquals("about:blank", Address.resolve("about:blank"))
    }

    @Test fun searches() {
        assertEquals("https://www.google.com/search?q=cats", Address.resolve("cats"))
        assertEquals("https://www.google.com/search?q=dark%20mode%20x.com", Address.resolve("dark mode x.com"))
        assertEquals("https://www.google.com/search?q=a%2Bb%26c%3Dd%23e%3Ff%2Fg", Address.resolve("a+b&c=d#e?f/g"))
        assertEquals("https://www.google.com/search?q=caf%C3%A9", Address.resolve("café"))
    }
}
