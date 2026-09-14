#define _DARWIN_C_SOURCE 1
#include <sys/acl.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>

/* Read-only and unprivileged. Never print a path, principal, or raw ACL.
 * Symlinks cannot hold ACLs on macOS; main checks both lexical and canonical
 * paths, and enforces ownership, modes, types, access, and socket privacy.
 */
static int unchanged(const struct stat *before, const struct stat *after) {
    return before->st_dev == after->st_dev && before->st_ino == after->st_ino &&
        before->st_mode == after->st_mode && before->st_uid == after->st_uid &&
        before->st_gid == after->st_gid &&
        before->st_ctimespec.tv_sec == after->st_ctimespec.tv_sec &&
        before->st_ctimespec.tv_nsec == after->st_ctimespec.tv_nsec;
}

static int deny_only(acl_t acl) {
    if (acl == NULL || acl_valid(acl) != 0) return 0;
    int cursor = ACL_FIRST_ENTRY;
    for (;;) {
        acl_entry_t entry;
        errno = 0;
        /* Darwin returns zero for an entry and -1/EINVAL at the end. */
        if (acl_get_entry(acl, cursor, &entry) != 0) return errno == EINVAL;
        cursor = ACL_NEXT_ENTRY;
        acl_tag_t tag;
        /* Even owner-only grants are outside this deliberately narrow policy. */
        if (acl_get_tag_type(entry, &tag) != 0 || tag != ACL_EXTENDED_DENY) return 0;
    }
}

static int trusted_acl(const char *path) {
    struct stat before, inspected, after;
    if (lstat(path, &before) != 0) return 0;
    if (!S_ISLNK(before.st_mode)) {
        filesec_t security = filesec_init();
        if (security == NULL) return 0;
        int present = 0;
        /* acl_get_link_np returns NULL for both a missing ACL and a read error.
         * First require a successful security read, then query ACL presence.
         * Never turn an access error into evidence that the ACL is absent.
         */
        if (lstatx_np(path, &inspected, security) != 0 ||
            !unchanged(&before, &inspected) ||
            filesec_query_property(security, FILESEC_ACL, &present) != 0) {
            filesec_free(security);
            return 0;
        }
        int trusted = 1;
        if (present) {
            acl_t acl = NULL;
            trusted = filesec_get_property(security, FILESEC_ACL, &acl) == 0 &&
                deny_only(acl);
            if (acl != NULL) acl_free(acl);
        }
        filesec_free(security);
        if (!trusted) return 0;
    }
    return lstat(path, &after) == 0 && unchanged(&before, &after);
}

int main(int argc, char **argv) {
    if (argc < 2 || argc > 257) return 1;
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] != '/' || strlen(argv[i]) > 4096) return 1;
        for (const unsigned char *p = (const unsigned char *)argv[i]; *p; p++) {
            if (*p < 32 || *p == 127) return 1;
        }
        if (!trusted_acl(argv[i])) return 1;
    }
    return fputs("screenfling-acl-v1:trusted\n", stdout) < 0 ? 1 : 0;
}
