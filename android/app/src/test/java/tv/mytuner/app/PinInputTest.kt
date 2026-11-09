package tv.mytuner.app

import org.junit.Assert.*
import org.junit.Test

class PinInputTest {
    @Test
    fun acceptsFourThroughEightDigitsAndOnlyExplicitSubmit() {
        val pin = PinInput()
        repeat(3) { pin.digit(1) }
        assertNull(pin.submit())
        pin.digit(2)
        assertFalse(pin.pending)
        assertEquals("1112", pin.submit())
        assertEquals("", pin.digits)
        pin.digit(5)
        pin.delete()
        assertEquals("", pin.digits)
        assertNull(pin.submit())
        pin.settled()
        repeat(10) { pin.digit(9) }
        assertEquals(8, pin.digits.length)
        pin.delete()
        assertEquals(7, pin.digits.length)
        assertEquals("9999999", pin.submit())
    }
}
