package tv.mytuner.app

object GuideNavigation {
    const val maximumShiftMs = 5 * 3_600_000L

    enum class Action(val tag: String) {
        EARLIER("guide-earlier"), NOW("guide-now"), LATER("guide-later")
    }

    data class Target(val shiftMs: Long, val focusTag: String)

    fun move(shiftMs: Long, action: Action): Target = Target(
        when (action) {
            Action.EARLIER -> shiftMs - 1_800_000L
            Action.NOW -> 0L
            Action.LATER -> shiftMs + 1_800_000L
        }.coerceIn(0L, maximumShiftMs),
        action.tag,
    )

    // After rebuilding, prefer any action/program the viewer has since focused.
    // The invoked action remains the fallback for an empty/error response.
    fun retainedTag(currentTag: String?, invokedTag: String?): String? = currentTag ?: invokedTag
}
