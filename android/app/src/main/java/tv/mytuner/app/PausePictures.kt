package tv.mytuner.app

class PausePictures {
    data class Request(val session: String, val entry: String)
    private var current: Request? = null

    fun begin(session: String, entry: String): Request = Request(session, entry).also { current = it }

    fun accepts(request: Request, session: String?, entry: String?, holding: Boolean): Boolean =
        current === request && request.session == session && request.entry == entry && holding

    fun invalidate() { current = null }

    companion object {
        fun dimensions(width: Int, height: Int): Pair<Int, Int>? {
            if (width <= 0 || height <= 0) return null
            val scale = minOf(1.0, 1920.0 / width, 1080.0 / height)
            return Pair((width * scale).toInt().coerceAtLeast(1), (height * scale).toInt().coerceAtLeast(1))
        }
    }
}
