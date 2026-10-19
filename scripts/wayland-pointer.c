/* Test-only pointer for a private headless Sway session.
 * It creates one zwlr_virtual_pointer_v1 and turns stdin lines into real
 * pointer events, as a mouse would send them:
 *   move X Y   absolute position in output-layout coordinates
 *   down / up  left button
 * No host devices or uinput access. Protocol:
 * wlr-protocols/unstable/wlr-virtual-pointer-unstable-v1.xml.
 * The connection owns the device until this process receives EOF or exits.
 */
/* clock_gettime is POSIX, which strict C11 hides unless requested. */
#define _POSIX_C_SOURCE 199309L
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <wayland-client.h>

#define BTN_LEFT 0x110
#define EXTENT_W 1024
#define EXTENT_H 640

/* Requests in protocol order: the opcode is the index. */
static const struct wl_message pointer_requests[] = {
    {"motion", "uff", NULL},
    {"motion_absolute", "uuuuu", NULL},
    {"button", "uuu", NULL},
    {"axis", "uuf", NULL},
    {"frame", "", NULL},
    {"axis_source", "u", NULL},
    {"axis_stop", "uu", NULL},
    {"axis_discrete", "uufi", NULL},
    {"destroy", "", NULL},
};
enum { MOTION_ABSOLUTE = 1, BUTTON = 2, FRAME = 4, DESTROY = 8 };
static const struct wl_interface pointer_interface = {
    "zwlr_virtual_pointer_v1", 1, 9, pointer_requests, 0, NULL
};
static const struct wl_interface *create_types[] = {
    &wl_seat_interface, &pointer_interface
};
static const struct wl_message manager_requests[] = {
    {"create_virtual_pointer", "?on", create_types}
};
static const struct wl_interface manager_interface = {
    "zwlr_virtual_pointer_manager_v1", 1, 1, manager_requests, 0, NULL
};

static void global(void *data, struct wl_registry *registry, uint32_t name,
                   const char *interface, uint32_t version) {
    if (version >= 1 && strcmp(interface, manager_interface.name) == 0) {
        *(struct wl_proxy **)data = wl_registry_bind(registry, name, &manager_interface, 1);
    }
}
static void removed(void *data, struct wl_registry *registry, uint32_t name) {
    (void)data; (void)registry; (void)name;
}
static uint32_t now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (uint32_t)(t.tv_sec * 1000 + t.tv_nsec / 1000000);
}
int main(void) {
    struct wl_display *display = wl_display_connect(NULL);
    if (!display) return 1;
    struct wl_proxy *manager = NULL;
    struct wl_registry *registry = wl_display_get_registry(display);
    const struct wl_registry_listener listener = {global, removed};
    if (!registry || wl_registry_add_listener(registry, &listener, &manager) < 0 ||
        wl_display_roundtrip(display) < 0 || !manager) return 2;
    struct wl_proxy *pointer = wl_proxy_marshal_flags(
        manager, 0, &pointer_interface, 1, 0, NULL, NULL);
    if (!pointer || wl_display_roundtrip(display) < 0) return 3;
    char line[64];
    while (fgets(line, sizeof line, stdin)) {
        unsigned x, y;
        if (sscanf(line, "move %u %u", &x, &y) == 2) {
            wl_proxy_marshal_flags(pointer, MOTION_ABSOLUTE, NULL, 1, 0,
                                   now_ms(), x, y, EXTENT_W, EXTENT_H);
        } else if (strncmp(line, "down", 4) == 0 || strncmp(line, "up", 2) == 0) {
            wl_proxy_marshal_flags(pointer, BUTTON, NULL, 1, 0,
                                   now_ms(), BTN_LEFT, line[0] == 'd' ? 1u : 0u);
        } else {
            continue;
        }
        wl_proxy_marshal_flags(pointer, FRAME, NULL, 1, 0);
        if (wl_display_roundtrip(display) < 0) return 4;
    }
    wl_proxy_marshal_flags(pointer, DESTROY, NULL, 1, WL_MARSHAL_FLAG_DESTROY);
    wl_proxy_destroy(manager);
    wl_registry_destroy(registry);
    wl_display_disconnect(display);
    return 0;
}
