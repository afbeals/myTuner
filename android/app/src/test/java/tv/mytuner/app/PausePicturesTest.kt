package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class PausePicturesTest {
    @Test
    fun aPausedFrameDoesNotDependOnTheControlsMenu() {
        val frames = PausePictures()
        val request = frames.begin("session", "episode")
        assertTrue(frames.accepts(request, "session", "episode", true))
        assertFalse(frames.accepts(request, "session", "episode", false))
        assertFalse(frames.accepts(request, "other-profile-session", "episode", true))
        assertFalse(frames.accepts(request, "session", "new-episode", true))
        assertFalse(frames.accepts(request, null, null, true))
    }

    @Test
    fun resumeStopAndARepeatedPauseDiscardTheOlderCopy() {
        val frames = PausePictures()
        val old = frames.begin("session", "episode")
        frames.invalidate()
        assertFalse(frames.accepts(old, "session", "episode", true))
        val current = frames.begin("session", "episode")
        assertFalse(frames.accepts(old, "session", "episode", true))
        assertTrue(frames.accepts(current, "session", "episode", true))
    }

    @Test
    fun aSingleFrameIsBoundedWithoutUpscalingOrChangingAspectRatio() {
        assertEquals(Pair(1920, 1080), PausePictures.dimensions(3840, 2160))
        assertEquals(Pair(1280, 720), PausePictures.dimensions(1280, 720))
        assertEquals(Pair(480, 1080), PausePictures.dimensions(960, 2160))
        assertNull(PausePictures.dimensions(0, 1080))
        assertNull(PausePictures.dimensions(1920, -1))
    }
}
