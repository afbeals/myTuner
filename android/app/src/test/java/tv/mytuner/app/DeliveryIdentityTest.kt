package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class DeliveryIdentityTest {
    private val original = DeliveryIdentity("s", "episode-a", "revision", 1)

    @Test
    fun delayedDeliveryCannotPlayAfterUnavailablePauseOrContextChange() {
        assertTrue(original.canPlay(original, true, false))
        assertFalse(original.canPlay(original, false, false))
        assertFalse(original.canPlay(original, true, true))
        assertFalse(original.canPlay(null, false, false))
        for (current in
            listOf(
                original.copy(generation = 2),
                original.copy(entry = "episode-b"),
                original.copy(session = "other"),
                original.copy(revision = "new"),
            )) {
            assertFalse(original.canPlay(current, true, false))
        }
    }

    @Test
    fun openTrackMenuCannotSelectFromAnOldEpisodeOrReloadedDelivery() {
        assertTrue(original.canSelect(original, true))
        assertFalse(original.canSelect(original.copy(entry = "episode-b"), true))
        assertFalse(original.canSelect(original.copy(generation = 2), true))
        assertFalse(original.canSelect(original, false))
    }
}
