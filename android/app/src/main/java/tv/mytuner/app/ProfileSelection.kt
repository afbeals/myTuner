package tv.mytuner.app

/** One pending selection per profile screen; keep focusable buttons available. */
class ProfileSelection {
    private var pending: String? = null
    fun begin(id: String): Boolean {
        if (pending != null) return false
        pending = id
        return true
    }
    fun complete(id: String): Boolean {
        if (pending != id) return false
        pending = null
        return true
    }
}
