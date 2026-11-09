package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class TransportControlsTest {
    @Test
    fun explicitPlayDoesNotPauseAnAlreadyPlayingSession() {
        assertNull(TransportControls.action(TransportControls.Command.PLAY, false))
        assertEquals("resume", TransportControls.action(TransportControls.Command.PLAY, true))
    }

    @Test
    fun explicitPauseDoesNotResumeAnAlreadyPausedSession() {
        assertNull(TransportControls.action(TransportControls.Command.PAUSE, true))
        assertEquals("pause", TransportControls.action(TransportControls.Command.PAUSE, false))
    }

    @Test
    fun playPauseTogglesBothSessionStates() {
        assertEquals("resume", TransportControls.action(TransportControls.Command.TOGGLE, true))
        assertEquals("pause", TransportControls.action(TransportControls.Command.TOGGLE, false))
    }
}
