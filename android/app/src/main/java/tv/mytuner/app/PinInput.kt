package tv.mytuner.app

class PinInput {
    var digits = ""
        private set

    var pending = false
        private set

    fun digit(value: Int) {
        if (!pending && value in 0..9 && digits.length < 8) digits += value
    }

    fun delete() {
        if (!pending) digits = digits.dropLast(1)
    }

    fun submit(): String? {
        if (pending || digits.length !in 4..8) return null
        val entered = digits
        digits = ""
        pending = true
        return entered
    }

    fun settled() {
        pending = false
    }
}
