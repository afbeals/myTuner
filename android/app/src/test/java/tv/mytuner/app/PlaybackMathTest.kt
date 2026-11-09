package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class PlaybackMathTest {
    @Test
    fun acceptsLanOriginsAndRejectsCredentialLeaks() {
        assertEquals(
            "http://192.168.1.20:8777",
            PlaybackMath.serverAddress(" http://192.168.1.20:8777/ "),
        )
        assertEquals("https://mytuner.home", PlaybackMath.serverAddress("https://mytuner.home"))
        listOf(
                "file:///tmp/movie",
                "http://user:password@host",
                "https://host/path",
                "https://host?token=secret",
                "http://host:0",
            )
            .forEach { raw ->
                assertTrue(runCatching { PlaybackMath.serverAddress(raw) }.isFailure)
            }
        assertEquals(
            "http://host:8777/api/segments/1?audioTrack=2",
            PlaybackMath.mediaAddress("http://host:8777", "/api/segments/1?audioTrack=2"),
        )
        listOf(
                "https://other/api/movie",
                "//other/api/movie",
                "/not-media",
                "http://host:8778/api/movie",
            )
            .forEach { raw ->
                assertTrue(
                    runCatching { PlaybackMath.mediaAddress("http://host:8777", raw) }.isFailure
                )
            }
    }

    @Test
    fun mapsSourceCuesAfterCommercialsWithoutLosingProgramOffset() {
        assertEquals(104500L, PlaybackMath.channelPosition(100000, 30000, 34500))
        assertEquals(34500L, PlaybackMath.sourcePosition(100000, 30000, 104500))
        val cues =
            PlaybackMath.captions(
                "WEBVTT\n\n1\n00:00:30.000 --> 00:00:35.000\nHello <i>world</i>\n\nNOTE ignore me\n"
            )
        assertEquals(1, cues.size)
        assertEquals(30000L, cues[0].start)
        assertEquals("Hello world", cues[0].text)
    }
}
