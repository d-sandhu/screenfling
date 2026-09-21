/* Test-only pointer capability for a private headless Sway session.
 * Only create_virtual_pointer (v1) is used. No host devices or uinput access.
 * Protocol: wlr-protocols/unstable/wlr-virtual-pointer-unstable-v1.xml.
 * The connection owns the device until this process receives EOF or exits.
 */
#include <stdio.h>
#include <string.h>
#include <wayland-client.h>

/* This create-only client sends no requests on the returned pointer object. */
static const struct wl_interface pointer_interface = {
    "zwlr_virtual_pointer_v1", 1, 0, NULL, 0, NULL
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
    while (getchar() != EOF) {}
    wl_proxy_destroy(pointer);
    wl_proxy_destroy(manager);
    wl_registry_destroy(registry);
    wl_display_disconnect(display);
    return 0;
}
