package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class ProfileSelectionTest {
    @Test fun firstSelectionOwnsResultUntilCompletion() {
        val selection = ProfileSelection()
        assertTrue(selection.begin("unlocked"))
        assertFalse(selection.begin("protected"))
        assertFalse(selection.complete("protected"))
        assertFalse(selection.begin("protected"))
        assertTrue(selection.complete("unlocked"))
        assertTrue(selection.begin("protected"))
    }
    @Test fun failedSelectionCanRetryAndNewScreenIsIndependent() {
        val selection = ProfileSelection()
        assertTrue(selection.begin("protected"))
        assertTrue(selection.complete("protected"))
        assertTrue(selection.begin("protected"))
        assertTrue(ProfileSelection().begin("unlocked"))
    }
}
