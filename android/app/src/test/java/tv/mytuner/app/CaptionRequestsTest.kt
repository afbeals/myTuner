package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class CaptionRequestsTest {
    @Test
    fun oldEpisodeCannotReplaceCurrentCuesEvenWithTheSameStreamIndex() {
        val requests = CaptionRequests()
        val old = requests.begin("session", "episode-a", 1, 2)
        requests.invalidate()
        val current = requests.begin("session", "episode-b", 2, 2)
        var cues = ""
        if (requests.isCurrent(current)) cues = "episode-b"
        if (requests.isCurrent(old)) cues = "episode-a"
        assertEquals("episode-b", cues)
        assertFalse(requests.isCurrent(old))
    }

    @Test
    fun newDeliveryAndRepeatedSelectionInvalidateOldSuccessAndFailure() {
        val requests = CaptionRequests()
        val old = requests.begin("session", "episode", 1, 2)
        val selectedAgain = requests.begin("session", "episode", 1, 2)
        assertFalse(requests.isCurrent(old))
        assertTrue(requests.isCurrent(selectedAgain))
        requests.invalidate()
        assertFalse(requests.isCurrent(selectedAgain))
        val replacement = requests.begin("other-session", "episode", 2, 2)
        assertTrue(requests.isCurrent(replacement))
    }
}
