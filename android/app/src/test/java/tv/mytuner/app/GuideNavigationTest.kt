package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class GuideNavigationTest {
    @Test fun consecutiveLaterActionsKeepTheirStableFocusThroughRebuildAndEmptyOrFailedLoads() {
        var shift = 0L
        repeat(3) { index ->
            val target = GuideNavigation.move(shift, GuideNavigation.Action.LATER)
            shift = target.shiftMs
            assertEquals((index + 1) * 1_800_000L, shift)
            assertEquals("guide-later", target.focusTag)
            assertEquals("guide-later", GuideNavigation.retainedTag(null, target.focusTag))
            assertEquals("guide-later", GuideNavigation.retainedTag(target.focusTag, target.focusTag))
        }
    }

    @Test fun nowAndEarlierPreserveTheInvokedActionAtBothWindowBounds() {
        val earlier = GuideNavigation.move(0, GuideNavigation.Action.EARLIER)
        assertEquals(0L, earlier.shiftMs)
        assertEquals("guide-earlier", earlier.focusTag)
        val later = GuideNavigation.move(GuideNavigation.maximumShiftMs, GuideNavigation.Action.LATER)
        assertEquals(GuideNavigation.maximumShiftMs, later.shiftMs)
        assertEquals("guide-later", later.focusTag)
        val now = GuideNavigation.move(later.shiftMs, GuideNavigation.Action.NOW)
        assertEquals(0L, now.shiftMs)
        assertEquals("guide-now", GuideNavigation.retainedTag(null, now.focusTag))
    }

    @Test fun asyncGuideRefreshRetainsAnyNewActionOrProgramTheViewerFocused() {
        assertEquals("guide-earlier", GuideNavigation.retainedTag("guide-earlier", "guide-later"))
        assertEquals("guide-channel:chosen:1", GuideNavigation.retainedTag("guide-channel:chosen:1", "guide-now"))
        assertNull(GuideNavigation.retainedTag(null, null))
    }
}
