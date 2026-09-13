#define _DARWIN_C_SOURCE 1
#include <sys/acl.h>
#include <sys/stat.h>
#include <stdio.h>
#include <string.h>

/* Read-only and unprivileged. Never print a path, principal, or raw ACL.
 * Unlike ls(1), an ACL read/validation error must not look like no ACL.
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

static int trusted_acl(const char *path) {
    struct stat before, after;
    if (lstat(path, &before) != 0) return 0;
    if (!S_ISLNK(before.st_mode)) {
        acl_t acl = acl_get_link_np(path, ACL_TYPE_EXTENDED);
        if (acl == NULL) return 0;
        if (acl_valid(acl) != 0) {
            acl_free(acl);
            return 0;
        }
        acl_entry_t entry;
        int cursor = ACL_FIRST_ENTRY;
        while (acl_get_entry(acl, cursor, &entry) == 0) {
            acl_tag_t tag;
            cursor = ACL_NEXT_ENTRY;
            /* Denials cannot expand Unix access. Any grant, including an
             * owner-only grant, is outside this deliberately narrow policy.
             */
            if (acl_get_tag_type(entry, &tag) != 0 || tag != ACL_EXTENDED_DENY) {
                acl_free(acl);
                return 0;
            }
        }
        acl_free(acl);
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
