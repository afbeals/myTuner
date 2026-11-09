package tv.mytuner.app

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class CleanupDispatcherTest {
    @Test
    fun completesLateJoinCleanupAfterActivityWorkerShutdown() {
        val worker = Executors.newSingleThreadExecutor()
        worker.shutdown()
        val done = CountDownLatch(1)
        val calls = AtomicInteger()
        val caller = Thread.currentThread()
        CleanupDispatcher.execute(worker) {
            assertNotSame(caller, Thread.currentThread())
            calls.incrementAndGet()
            done.countDown()
        }
        assertTrue(
            "Late join cleanup must run after executor shutdown",
            done.await(2, TimeUnit.SECONDS),
        )
        assertEquals(1, calls.get())
    }

    @Test
    fun usesTheExistingWorkerWhileItIsAvailable() {
        val worker = Executors.newSingleThreadExecutor()
        try {
            val expected = worker.submit<Thread> { Thread.currentThread() }.get()
            val done = CountDownLatch(1)
            var actual: Thread? = null
            CleanupDispatcher.execute(worker) {
                actual = Thread.currentThread()
                done.countDown()
            }
            assertTrue(done.await(2, TimeUnit.SECONDS))
            assertSame(expected, actual)
        } finally {
            worker.shutdownNow()
        }
    }
}
