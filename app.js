document.addEventListener("DOMContentLoaded", () => {
    // --- 1. CONFIGURATION ---
    // Replace with your Firebase project's configuration
    const firebaseConfig = {
        apiKey: "AIzaSyCpI6gYXpHbdwLIuGzLBJca2asuGoSs0TQ",
        authDomain: "album-tierlist.firebaseapp.com",
        databaseURL:
            "https://album-tierlist-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "album-tierlist",
        storageBucket: "album-tierlist.firebasestorage.app",
        messagingSenderId: "104924208449",
        appId: "1:104924208449:web:74e46420ad14f57d8695c0",
        measurementId: "G-4STB2H8ELM",
    };

    // Replace with your Spotify App's credentials
    const spotifyConfig = {
        clientId: "64728b5e13784d218442b13368311be3",
        clientSecret: "a4aa6fb243564b0d94936418ad53fc72",
    };

    // --- 2. INITIALIZATION ---
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    const albumsRef = db.ref("albums");
    const passwordRef = db.ref("admin/password");
    let spotifyToken = "";
    let editMode = false;
    let sortableInstances = [];
    let lastDeleted = null; // for undo

    // --- 3. DOM ELEMENTS ---
    const tierListContainer = document.getElementById("tier-list-container");
    const queueContainer = document.getElementById("queue-container");
    const loginBtn = document.getElementById("login-btn");
    const passwordInput = document.getElementById("password-input");
    const addAlbumBtn = document.getElementById("add-album-btn");
    const spotifyLinkInput = document.getElementById("spotify-link-input");
    const searchInput = document.getElementById("search-input");
    const exportPngBtn = document.getElementById("export-png-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const tierBoard = document.getElementById("tier-board");
    const randomQueueBtn = document.getElementById("random-queue-btn");
    const topActions = document.getElementById("top-actions");

    // Modal & toast
    const modalEl = document.getElementById("albumModal");
    const modal =
        window.bootstrap && modalEl ? new bootstrap.Modal(modalEl) : null;
    const modalArt = document.getElementById("modal-art");
    const modalTitle = document.getElementById("modal-title");
    const modalArtist = document.getElementById("modal-artist");
    const modalMeta = document.getElementById("modal-meta");
    const modalTracks = document.getElementById("modal-tracks");
    const modalSpotifyLink = document.getElementById("modal-spotify-link");
    const undoToastEl = document.getElementById("undoToast");
    const undoToast =
        window.bootstrap && undoToastEl
            ? new bootstrap.Toast(undoToastEl)
            : null;
    const undoDeleteBtn = document.getElementById("undo-delete-btn");

    // --- 4. SPOTIFY API ---
    const getSpotifyToken = async () => {
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization:
                    "Basic " +
                    btoa(
                        spotifyConfig.clientId +
                            ":" +
                            spotifyConfig.clientSecret
                    ),
            },
            body: "grant_type=client_credentials",
        });
        const data = await response.json();
        spotifyToken = data.access_token;
    };

    const fetchAlbumFromSpotify = async () => {
        if (!spotifyLinkInput.value.includes("spotify.com/album/")) {
            alert("Invalid Spotify album link.");
            return;
        }
        const albumId = spotifyLinkInput.value.split("album/")[1].split("?")[0];

        const response = await fetch(
            `https://api.spotify.com/v1/albums/${albumId}`,
            {
                headers: { Authorization: `Bearer ${spotifyToken}` },
            }
        );

        if (response.status === 401) {
            // Token expired
            await getSpotifyToken();
            return fetchAlbumFromSpotify(); // Retry
        }

        const data = await response.json();
        const newAlbum = {
            id: data.id,
            title: data.name,
            artist: data.artists.map((a) => a.name).join(", "),
            art: data.images[1]?.url || data.images[0].url, // Use 300px or 640px image
            tier: "queue",
            modifier: "neutral",
        };

        albumsRef.child(newAlbum.id).set(newAlbum);
        spotifyLinkInput.value = "";
    };

    // --- 5. UI & TIER CREATION ---
    const createAlbumElement = (album) => {
        const el = document.createElement("div");
        el.className = "album";
        el.dataset.id = album.id;
        el.dataset.title = (album.title || "").toLowerCase();
        el.dataset.artist = (album.artist || "").toLowerCase();

        let modifierHTML = "";
        if (album.modifier === "+")
            modifierHTML =
                '<div class="album-modifier positive"><i class="fas fa-plus"></i></div>';
        if (album.modifier === "-")
            modifierHTML =
                '<div class="album-modifier negative"><i class="fas fa-minus"></i></div>';

        el.innerHTML = `
            <img src="${album.art}" alt="${album.title}" class="album-art" crossorigin="anonymous" referrerpolicy="no-referrer">
            <div class="album-info">${album.title}</div>
            ${modifierHTML}
            <div class="album-buttons">
                <button class="btn btn-success btn-sm btn-plus"><i class="fas fa-plus"></i></button>
                <button class="btn btn-danger btn-sm btn-minus"><i class="fas fa-minus"></i></button>
                <button class="btn btn-secondary btn-sm btn-reset"><i class="fas fa-times"></i></button>
                <button class="btn btn-outline-light btn-sm btn-delete"><i class="fas fa-trash"></i></button>
            </div>
        `;

        // Ensure image loads properly for canvas export
        const img = el.querySelector(".album-art");
        img.onload = function () {
            // Image loaded successfully - ready for canvas export
        };
        img.onerror = function () {
            // If CORS fails, try to load via a proxy or use a fallback
            console.warn("Failed to load image with CORS:", album.art);
        };

        // Attach events for modifier buttons
        el.querySelector(".btn-plus").addEventListener("click", (e) => {
            e.stopPropagation();
            updateModifier(album.id, "+");
        });
        el.querySelector(".btn-minus").addEventListener("click", (e) => {
            e.stopPropagation();
            updateModifier(album.id, "-");
        });
        el.querySelector(".btn-reset").addEventListener("click", (e) => {
            e.stopPropagation();
            updateModifier(album.id, "neutral");
        });
        const delBtn = el.querySelector(".btn-delete");
        if (delBtn) {
            delBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                await deleteAlbum(album.id);
            });
        }

        // Click to open details modal - double tap on mobile
        let lastTap = 0;
        let tapTimeout = null;
        const isMobile = () => window.innerWidth <= 576;

        el.addEventListener("click", (e) => {
            if (!isMobile()) {
                // Desktop behavior - open modal immediately
                openAlbumModal(album.id);
                return;
            }

            // Mobile behavior - double tap required
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;

            if (tapLength < 500 && tapLength > 0) {
                // Double tap detected - open modal
                if (tapTimeout) {
                    clearTimeout(tapTimeout);
                    tapTimeout = null;
                }

                // Hide controls first
                const buttons = el.querySelector(".album-buttons");
                if (buttons) {
                    buttons.classList.remove("show-mobile");
                }

                openAlbumModal(album.id);
            } else {
                // Single tap - show controls
                lastTap = currentTime;

                // Show controls temporarily
                const buttons = el.querySelector(".album-buttons");
                if (buttons && editMode) {
                    buttons.classList.add("show-mobile");

                    // Hide controls after 3 seconds
                    tapTimeout = setTimeout(() => {
                        buttons.classList.remove("show-mobile");
                    }, 3000);
                }
            }
        });

        return el;
    };

    const renderTiers = () => {
        // Define tier order, now including a goat tier at the top
        const tiers = [
            { key: "🐐", label: "🐐" },
            { key: "S", label: "S" },
            { key: "A", label: "A" },
            { key: "B", label: "B" },
            { key: "C", label: "C" },
            { key: "D", label: "D" },
            { key: "E", label: "E" },
            { key: "F", label: "F" },
        ];
        tierListContainer.innerHTML = ""; // Clear existing tiers
        tiers.forEach((tier) => {
            const tierEl = document.createElement("div");
            tierEl.className = "tier";
            tierEl.dataset.tier = tier.key;
            tierEl.innerHTML = `
                <div class="tier-label-container">
            <span class="tier-label">${tier.label}</span>
                </div>
                <div id="tier-${tier.key}" class="tier-dropzone"></div>
            `;
            tierListContainer.appendChild(tierEl);
        });
    };

    // --- 6. FIREBASE & DATA SYNC ---
    const updateModifier = (albumId, modifier) => {
        if (!editMode) return;
        albumsRef.child(albumId).update({ modifier: modifier });
    };

    const deleteAlbum = async (albumId) => {
        if (!editMode) return;
        const snapshot = await albumsRef.child(albumId).once("value");
        if (!snapshot.exists()) return;
        lastDeleted = snapshot.val();
        await albumsRef.child(albumId).remove();
        if (undoToast) undoToast.show();
    };

    const restoreLastDeleted = async () => {
        if (!lastDeleted) return;
        await albumsRef.child(lastDeleted.id).set(lastDeleted);
        lastDeleted = null;
        if (undoToast) undoToast.hide();
    };

    const loadAndDisplayAlbums = () => {
        albumsRef.on("value", (snapshot) => {
            // Clear all albums from UI before re-drawing
            document.querySelectorAll(".album").forEach((el) => el.remove());

            const allAlbums = snapshot.val();
            if (allAlbums) {
                const byTier = {};
                Object.values(allAlbums).forEach((album) => {
                    const t = album.tier || "queue";
                    byTier[t] = byTier[t] || [];
                    byTier[t].push(album);
                });

                // Place queue
                (byTier["queue"] || [])
                    .sort(
                        (a, b) =>
                            (a.order ?? 1e12) - (b.order ?? 1e12) ||
                            a.title.localeCompare(b.title)
                    )
                    .forEach((a) =>
                        queueContainer.appendChild(createAlbumElement(a))
                    );

                // Place tiers
                ["🐐", "S", "A", "B", "C", "D", "E", "F"].forEach((t) => {
                    const cont = document.getElementById(`tier-${t}`);
                    if (!cont) return;
                    (byTier[t] || [])
                        .sort(
                            (a, b) =>
                                (a.order ?? 1e12) - (b.order ?? 1e12) ||
                                a.title.localeCompare(b.title)
                        )
                        .forEach((a) =>
                            cont.appendChild(createAlbumElement(a))
                        );
                });
            }

            applySearchFilter();
        });
    };

    // --- 7. ACCESS CONTROL & EDIT MODE ---
    const toggleEditMode = (enabled) => {
        editMode = enabled;
        document.getElementById("edit-section").style.display = enabled
            ? "block"
            : "none";
        document.getElementById("password-section").style.display = enabled
            ? "none"
            : "flex";

        // Enable or disable drag-and-drop
        sortableInstances.forEach((sortable) =>
            sortable.option("disabled", !enabled)
        );
        // Toggle UI affordances
        document.body.classList.toggle("edit-enabled", enabled);
        if (topActions) topActions.style.display = enabled ? "flex" : "none";
    };

    const checkPassword = () => {
        const enteredPassword = passwordInput.value;
        passwordRef.once("value", (snapshot) => {
            // IMPORTANT: For a real application, use Firebase Authentication for security.
            // This method is for simplicity only.
            if (snapshot.val() && snapshot.val() === enteredPassword) {
                // Store login state in localStorage
                localStorage.setItem("loggedIn", "true");
                toggleEditMode(true);
            } else {
                alert("Incorrect password.");
            }
        });
    };

    // --- 8. DRAG-AND-DROP ---
    const initializeDragAndDrop = () => {
        const dropzones = [...document.querySelectorAll(".tier-dropzone")];
        dropzones.forEach((zone) => {
            const sortable = new Sortable(zone, {
                group: "albums",
                animation: 150,
                disabled: !editMode, // Disabled by default
                onEnd: (evt) => {
                    const albumId = evt.item.dataset.id;
                    const newTier =
                        evt.to.id === "queue-container"
                            ? "queue"
                            : evt.to.id.replace("tier-", "");
                    const updates = {};
                    updates[`/${albumId}/tier`] = newTier;
                    // Update order in destination
                    [...evt.to.querySelectorAll(".album")].forEach(
                        (child, idx) => {
                            updates[`/${child.dataset.id}/order`] = idx;
                        }
                    );
                    // Update source if moved across
                    if (evt.to !== evt.from) {
                        [...evt.from.querySelectorAll(".album")].forEach(
                            (child, idx) => {
                                updates[`/${child.dataset.id}/order`] = idx;
                            }
                        );
                    }
                    albumsRef.update(updates);
                },
            });
            sortableInstances.push(sortable);
        });
    };

    // --- 9. INITIAL LOAD ---
    const main = async () => {
        // Use stored login info to persist edit mode
        if (localStorage.getItem("loggedIn") === "true") {
            toggleEditMode(true);
        }
        await getSpotifyToken();
        renderTiers();
        initializeDragAndDrop();
        loadAndDisplayAlbums();

        loginBtn.addEventListener("click", checkPassword);
        addAlbumBtn.addEventListener("click", fetchAlbumFromSpotify);
        if (logoutBtn)
            logoutBtn.addEventListener("click", () => {
                localStorage.removeItem("loggedIn");
                toggleEditMode(false);
            });
        if (undoDeleteBtn)
            undoDeleteBtn.addEventListener("click", restoreLastDeleted);
        if (searchInput)
            searchInput.addEventListener("input", applySearchFilter);
        if (exportPngBtn) exportPngBtn.addEventListener("click", exportPNG);
        if (randomQueueBtn)
            randomQueueBtn.addEventListener("click", pickRandomFromQueue);
    };

    main();

    // --- 10. Extras ---
    function applySearchFilter() {
        const q = (searchInput?.value || "").trim().toLowerCase();
        const all = document.querySelectorAll(".album");
        all.forEach((el) => {
            if (!q) {
                el.style.display = "";
                return;
            }
            const title = el.dataset.title || "";
            const artist = el.dataset.artist || "";
            el.style.display =
                title.includes(q) || artist.includes(q) ? "" : "none";
        });
    }

    async function openAlbumModal(albumId) {
        if (!modal) return;
        try {
            let resp = await fetch(
                `https://api.spotify.com/v1/albums/${albumId}`,
                {
                    headers: { Authorization: `Bearer ${spotifyToken}` },
                }
            );
            if (resp.status === 401) {
                await getSpotifyToken();
                resp = await fetch(
                    `https://api.spotify.com/v1/albums/${albumId}`,
                    {
                        headers: { Authorization: `Bearer ${spotifyToken}` },
                    }
                );
            }
            const data = await resp.json();
            modalArt.src = data.images?.[1]?.url || data.images?.[0]?.url || "";
            modalTitle.textContent = data.name || "";
            modalArtist.textContent = (data.artists || [])
                .map((a) => a.name)
                .join(", ");
            const date = data.release_date || "";
            const total =
                data.total_tracks || (data.tracks?.items?.length ?? 0);
            modalMeta.textContent = [date, total ? `${total} tracks` : null]
                .filter(Boolean)
                .join(" • ");
            modalSpotifyLink.href =
                data.external_urls?.spotify ||
                `https://open.spotify.com/album/${albumId}`;
            modalTracks.innerHTML = "";
            (data.tracks?.items || []).forEach((t) => {
                const li = document.createElement("li");
                li.textContent = t.name;
                modalTracks.appendChild(li);
            });
            modal.show();
        } catch (e) {
            console.error("Failed to open album modal", e);
        }
    }

    function exportPNG() {
        if (!tierBoard) return;

        // Wait for all images to load before capturing
        const images = Array.from(document.querySelectorAll("img.album-art"));
        const imagePromises = images.map((img) => {
            return new Promise((resolve) => {
                if (img.complete) {
                    resolve();
                } else {
                    img.onload = resolve;
                    img.onerror = resolve; // Continue even if some images fail
                }
            });
        });

        Promise.all(imagePromises).then(() => {
            html2canvas(tierBoard, {
                backgroundColor: "#121212",
                scale: window.devicePixelRatio || 2,
                useCORS: true,
                allowTaint: true,
                foreignObjectRendering: false,
                imageTimeout: 0,
                logging: false,
                onclone: function (clonedDoc) {
                    // Ensure all images in the cloned document have CORS attributes
                    const clonedImages =
                        clonedDoc.querySelectorAll("img.album-art");
                    clonedImages.forEach((img) => {
                        img.setAttribute("crossorigin", "anonymous");
                        img.setAttribute("referrerpolicy", "no-referrer");
                    });
                },
            })
                .then((canvas) => {
                    const link = document.createElement("a");
                    link.download = `album-tierlist-${new Date()
                        .toISOString()
                        .slice(0, 10)}.png`;
                    link.href = canvas.toDataURL("image/png", 1.0);
                    link.click();
                })
                .catch((error) => {
                    console.error("Error generating PNG:", error);
                    // Fallback - try without CORS
                    html2canvas(tierBoard, {
                        backgroundColor: "#121212",
                        scale: window.devicePixelRatio || 2,
                        useCORS: false,
                        allowTaint: true,
                    }).then((canvas) => {
                        const link = document.createElement("a");
                        link.download = `album-tierlist-${new Date()
                            .toISOString()
                            .slice(0, 10)}.png`;
                        link.href = canvas.toDataURL("image/png", 1.0);
                        link.click();
                    });
                });
        });
    }

    function pickRandomFromQueue() {
        const items = [...queueContainer.querySelectorAll(".album")] // respect search filter
            .filter((el) => el.style.display !== "none");
        if (items.length === 0) return;
        const chosen = items[Math.floor(Math.random() * items.length)];
        chosen.classList.add("rand-highlight");
        chosen.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center",
        });
        setTimeout(() => chosen.classList.remove("rand-highlight"), 1200);
    }
});
