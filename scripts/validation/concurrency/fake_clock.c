/*
 * Process-local realtime clock interposer for the production-host validator.
 *
 * The validator changes the signed millisecond offset in the file named by
 * BOREAL_FAKE_CLOCK_FILE. Only CLOCK_REALTIME/gettimeofday/time are shifted;
 * monotonic time remains real so timer scheduling is not replaced by a mock.
 * macOS loads the interposers with DYLD_INSERT_LIBRARIES; Linux uses
 * LD_PRELOAD. Other platforms do not load this library.
 */
#define _GNU_SOURCE
#define _DARWIN_C_SOURCE

#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>
#if !defined(__APPLE__)
#include <dlfcn.h>
#include <errno.h>
#endif

static int64_t offset_ms(void) {
    const char *path = getenv("BOREAL_FAKE_CLOCK_FILE");
    if (path == NULL || *path == '\0') {
        return 0;
    }
    int fd = open(path, O_RDONLY);
    if (fd < 0) {
        return 0;
    }
    char buffer[64];
    ssize_t length = read(fd, buffer, sizeof(buffer) - 1);
    close(fd);
    if (length <= 0) {
        return 0;
    }
    buffer[length] = '\0';
    char *end = NULL;
    long long value = strtoll(buffer, &end, 10);
    if (end == buffer) {
        return 0;
    }
    return (int64_t)value;
}

static void add_offset(struct timespec *value) {
    int64_t millis = offset_ms();
    int64_t nanos = millis * 1000000LL;
    int64_t seconds = nanos / 1000000000LL;
    int64_t remainder = nanos % 1000000000LL;
    value->tv_sec += (time_t)seconds;
    value->tv_nsec += (long)remainder;
    if (value->tv_nsec >= 1000000000L) {
        value->tv_sec += 1;
        value->tv_nsec -= 1000000000L;
    } else if (value->tv_nsec < 0) {
        value->tv_sec -= 1;
        value->tv_nsec += 1000000000L;
    }
}

static int boreal_clock_gettime(clockid_t clock_id, struct timespec *value) {
    if (value == NULL) {
        return -1;
    }
#if defined(__APPLE__)
    uint64_t nanos = clock_gettime_nsec_np(clock_id);
    if (nanos == UINT64_MAX) {
        return -1;
    }
    value->tv_sec = (time_t)(nanos / 1000000000ULL);
    value->tv_nsec = (long)(nanos % 1000000000ULL);
#else
    typedef int (*clock_gettime_fn)(clockid_t, struct timespec *);
    static clock_gettime_fn real_clock_gettime = NULL;
    if (real_clock_gettime == NULL) {
        real_clock_gettime = (clock_gettime_fn)dlsym(RTLD_NEXT, "clock_gettime");
    }
    if (real_clock_gettime == NULL || real_clock_gettime(clock_id, value) != 0) {
        errno = ENOSYS;
        return -1;
    }
#endif
    if (clock_id == CLOCK_REALTIME) add_offset(value);
    return 0;
}

static int boreal_gettimeofday(struct timeval *value, void *timezone_value) {
    (void)timezone_value;
    if (value == NULL) {
        return -1;
    }
    struct timespec current;
    if (boreal_clock_gettime(CLOCK_REALTIME, &current) != 0) {
        return -1;
    }
    value->tv_sec = current.tv_sec;
    value->tv_usec = (suseconds_t)(current.tv_nsec / 1000L);
    return 0;
}

static time_t boreal_time(time_t *value) {
    struct timespec current;
    if (boreal_clock_gettime(CLOCK_REALTIME, &current) != 0) {
        return (time_t)-1;
    }
    time_t result = current.tv_sec;
    if (value != NULL) {
        *value = result;
    }
    return result;
}

#if defined(__APPLE__)
__attribute__((used)) static struct {
    const void *replacement;
    const void *replacee;
} interposers[] __attribute__((section("__DATA,__interpose"))) = {
    {(const void *)boreal_clock_gettime, (const void *)clock_gettime},
    {(const void *)boreal_gettimeofday, (const void *)gettimeofday},
    {(const void *)boreal_time, (const void *)time},
};
#else
__attribute__((visibility("default"))) int clock_gettime(
    clockid_t clock_id,
    struct timespec *value
) {
    return boreal_clock_gettime(clock_id, value);
}

__attribute__((visibility("default"))) int gettimeofday(
    struct timeval *value,
    void *timezone_value
) {
    return boreal_gettimeofday(value, timezone_value);
}

__attribute__((visibility("default"))) time_t time(time_t *value) {
    return boreal_time(value);
}
#endif
