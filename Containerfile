# Dev toolchain image for Book of Chaos.
#
# The host (Bazzite / Fedora Silverblue) is image-based and immutable — installing
# rustup, Node, and the SpacetimeDB CLI onto it directly is either impossible or a
# layering headache. Everything therefore builds inside this container, driven by
# ./scripts/dev.sh. The host only ever needs podman + distrobox.
#
# Language toolchains are NOT baked in here. They are installed by
# `./scripts/dev.sh setup` into .devhome/ so that a version bump is a script edit
# rather than an image rebuild.

FROM registry.fedoraproject.org/fedora:43

# distrobox integration requirements plus the C toolchain the Rust wasm target needs.
RUN dnf -y install --setopt=install_weak_deps=False \
      bash bc curl diffutils findutils git gnupg2 hostname iproute less \
      lsof ncurses openssh-clients pigz procps-ng rsync shadow-utils sudo \
      tar time unzip util-linux wget which xz zip \
      gcc gcc-c++ make pkgconf-pkg-config openssl-devel perl-core \
      ca-certificates jq \
      gh \
 && dnf clean all \
 && rm -rf /var/cache/dnf

LABEL org.opencontainers.image.title="book-of-chaos-dev" \
      org.opencontainers.image.description="Rust + Node + SpacetimeDB dev toolchain for Book of Chaos"
