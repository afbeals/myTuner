package tv.mytuner.app

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class ConnectRequestsTest {
    @Test fun olderServerResultCannotNavigateWhileLatestServerIsPending() {
        val requests = ConnectRequests()
        val workers = Executors.newFixedThreadPool(2)
        val queue = UiTaskQueue(workers)
        val oldStarted = CountDownLatch(1)
        val newStarted = CountDownLatch(1)
        val releaseOld = CountDownLatch(1)
        val releaseNew = CountDownLatch(1)
        val oldDelivered = CountDownLatch(1)
        val newDelivered = CountDownLatch(1)
        val effects = mutableListOf<String>()
        val old = requests.begin()
        try {
            queue.execute({ requests.isCurrent(old) }) {
                oldStarted.countDown()
                releaseOld.await(5, TimeUnit.SECONDS)
                synchronized(effects) {
                    if (requests.isCurrent(old)) effects.add("save A and pair")
                }
                oldDelivered.countDown()
            }
            assertTrue(oldStarted.await(5, TimeUnit.SECONDS))
            val latest = requests.begin()
            queue.execute({ requests.isCurrent(latest) }) {
                newStarted.countDown()
                releaseNew.await(5, TimeUnit.SECONDS)
                synchronized(effects) {
                    if (requests.isCurrent(latest)) effects.add("save B and pair")
                }
                newDelivered.countDown()
            }
            assertTrue(newStarted.await(5, TimeUnit.SECONDS))
            releaseOld.countDown()
            assertTrue(oldDelivered.await(5, TimeUnit.SECONDS))
            synchronized(effects) { assertTrue(effects.isEmpty()) }
            releaseNew.countDown()
            assertTrue(newDelivered.await(5, TimeUnit.SECONDS))
            synchronized(effects) { assertEquals(listOf("save B and pair"), effects.toList()) }
        } finally {
            releaseOld.countDown()
            releaseNew.countDown()
            workers.shutdownNow()
        }
    }

    @Test fun lateFailureAndSameAddressRetryCannotOverwriteLatestOutcome() {
        val requests = ConnectRequests()
        val first = requests.begin()
        val retry = requests.begin()
        var message = "Connecting to the latest submission"
        if (requests.isCurrent(first)) message = "Earlier connection failed"
        assertEquals("Connecting to the latest submission", message)
        assertTrue(requests.isCurrent(retry))
        if (requests.isCurrent(retry)) message = "Latest connection succeeded"
        if (requests.isCurrent(first)) message = "Earlier authorization expired"
        assertEquals("Latest connection succeeded", message)
    }

    @Test fun newerSubmissionInvalidatesEarlierWorkEvenBeforeAddressValidation() {
        val requests = ConnectRequests()
        val pending = requests.begin()
        requests.begin()
        assertFalse(requests.isCurrent(pending))
        var calls = 0
        UiTaskQueue(java.util.concurrent.Executor { it.run() }).execute({ requests.isCurrent(pending) }) { calls++ }
        assertEquals(0, calls)
    }
}
