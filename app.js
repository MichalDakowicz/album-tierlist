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

    // --- 3. DOM ELEMENTS ---
    const tierListContainer = document.getElementById("tier-list-container");
    const queueContainer = document.getElementById("queue-container");
    const loginBtn = document.getElementById("login-btn");
    const passwordInput = document.getElementById("password-input");
    const addAlbumBtn = document.getElementById("add-album-btn");
    const spotifyLinkInput = document.getElementById("spotify-link-input");

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

        let modifierHTML = "";
        if (album.modifier === "+")
            modifierHTML = '<div class="album-modifier positive">+</div>';
        if (album.modifier === "-")
            modifierHTML = '<div class="album-modifier negative">-</div>';

        el.innerHTML = `
            <img src="${album.art}" alt="${album.title}" class="album-art">
            <div class="album-info">${album.title}</div>
            ${modifierHTML}
            <div class="album-buttons">
                <button class="btn btn-success btn-sm btn-plus">+</button>
                <button class="btn btn-danger btn-sm btn-minus">-</button>
                <button class="btn btn-secondary btn-sm btn-reset">×</button>
            </div>
        `;

        // Attach events for modifier buttons
        el.querySelector(".btn-plus").addEventListener("click", () =>
            updateModifier(album.id, "+")
        );
        el.querySelector(".btn-minus").addEventListener("click", () =>
            updateModifier(album.id, "-")
        );
        el.querySelector(".btn-reset").addEventListener("click", () =>
            updateModifier(album.id, "neutral")
        );

        return el;
    };

    const renderTiers = () => {
        const tiers = ["S", "A", "B", "C", "D", "E", "F"];
        tierListContainer.innerHTML = ""; // Clear existing tiers
        tiers.forEach((tier) => {
            const tierEl = document.createElement("div");
            tierEl.className = "tier";
            tierEl.dataset.tier = tier;
            tierEl.innerHTML = `
                <div class="tier-label-container">
                    <span class="tier-label">${tier}</span>
                </div>
                <div id="tier-${tier}" class="tier-dropzone"></div>
            `;
            tierListContainer.appendChild(tierEl);
        });
    };

    // --- 6. FIREBASE & DATA SYNC ---
    const updateModifier = (albumId, modifier) => {
        if (!editMode) return;
        albumsRef.child(albumId).update({ modifier: modifier });
    };

    const loadAndDisplayAlbums = () => {
        albumsRef.on("value", (snapshot) => {
            // Clear all albums from UI before re-drawing
            document.querySelectorAll(".album").forEach((el) => el.remove());

            const allAlbums = snapshot.val();
            if (allAlbums) {
                Object.values(allAlbums).forEach((album) => {
                    const albumEl = createAlbumElement(album);
                    const container =
                        album.tier === "queue"
                            ? queueContainer
                            : document.getElementById(`tier-${album.tier}`);
                    if (container) {
                        container.appendChild(albumEl);
                    }
                });
            }
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
                    albumsRef.child(albumId).update({ tier: newTier });
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
    };

    main();
});
