/*
 * slovak.js
 * =========
 *
 * Fonctions interactives pour les mémos de slovaque.
 *
 */


// ==========================================================================
// Variables globales
// ==========================================================================

let currentUtterance = null;
let selectedVoice = null;
let translationsVisible = true;

// Passe à true dès qu'une voix slovaque a été trouvée.
// Tant que c'est false, le TTS est désactivé (pas question
// de lire du slovaque avec un accent anglais).
let slovakVoiceAvailable = false;
let ttsWarningShown = false;

// ==========================================================================
// Synthèse vocale
// ==========================================================================

/*
 * Cherche la meilleure voix slovaque disponible.
 * Priorité :
 * 1. Langue exacte sk-SK
 * 2. Toute langue commençant par sk
 * 3. Nom contenant "Slovak"
 * 4. Aucune voix spécifique
 */

function findSlovakVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) { return null; }
    // Langue exacte : sk-SK
    const exactVoice = voices.find(voice => voice.lang.toLowerCase() === "sk-sk");
    if (exactVoice) { return exactVoice; }
    // Toute langue slovaque
    const slovakVoice = voices.find(voice => voice.lang.toLowerCase().startsWith("sk"));
    if (slovakVoice) { return slovakVoice; }
    // Nom de voix contenant "Slovak"
    const namedVoice = voices.find(voice => voice.name.toLowerCase().includes("slovak"));
    if (namedVoice) { return namedVoice; }
    return null;
}


// ==========================================================================
// Avertissement : pas de voix slovaque disponible
// ==========================================================================

/*
 * Affiche un petit toast d'avertissement quand aucune voix
 * slovaque n'est disponible sur l'appareil.
 *
 * Ne s'affiche qu'une seule fois par chargement de page,
 * pour ne pas spammer l'utilisateur à chaque clic.
 */

function showTtsWarning() {
    if (ttsWarningShown) { return; }
    ttsWarningShown = true;

    const toast = document.createElement("div");
    toast.textContent =
        "⚠️ Aucune voix slovaque disponible sur cet appareil : " +
        "la lecture audio est désactivée (plutôt ça que du slovaque à l'accent anglais 😅).";

    Object.assign(
        toast.style,
        {
            position: "fixed",
            bottom: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "90%",
            padding: "10px 16px",
            borderRadius: "8px",
            background: "#c0392b",
            color: "#fff",
            fontSize: "0.9em",
            lineHeight: "1.4",
            textAlign: "center",
            zIndex: "1000",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
        }
    );

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
}


// ==========================================================================
// Lire une phrase
// ==========================================================================

/*
 * Lit une phrase en slovaque.
 *
 * text :
 *     Texte à prononcer
 *
 * rate :
 *     0.9 = vitesse normale
 *     0.65 = vitesse lente
 */

function speak(text, rate = 0.9) {
    if (!("speechSynthesis" in window)) {
        alert("La synthèse vocale n'est pas disponible sur cet appareil.");
        return;
    }

    // Pas de voix slovaque : on n'active pas le TTS,
    // on prévient juste une fois.
    if (!slovakVoiceAvailable) {
        showTtsWarning();
        return;
    }

    // Arrête une éventuelle lecture précédente
    stopSpeaking();
    // Crée la phrase à prononcer
    currentUtterance = new SpeechSynthesisUtterance(text);
    // Langue slovaque
    currentUtterance.lang = "sk-SK";
    // Vitesse
    currentUtterance.rate = rate;
    // Ton
    currentUtterance.pitch = 1.0;
    // Recherche de la voix
    selectedVoice = findSlovakVoice();

    if (selectedVoice) {
        currentUtterance.voice = selectedVoice;
    }

    // Lecture
    window.speechSynthesis.speak(currentUtterance);
}


// ==========================================================================
// Arrêter la lecture
// ==========================================================================

function stopSpeaking() {
    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }
    currentUtterance = null;
}

// ==========================================================================
// Lire toutes les phrases
// ==========================================================================

/*
 * Lit toutes les phrases audio-card
 * les unes après les autres.
 *
 * Les éléments masqués par une recherche
 * ne sont pas lus.
 */

function speakAll() {
    // Pas de voix slovaque : on n'active pas le TTS,
    // on prévient juste une fois.
    if (!slovakVoiceAvailable) {
        showTtsWarning();
        return;
    }

    stopSpeaking();
    const cards = document.querySelectorAll(".audio-text:not(.search-hidden)");
    if (!cards.length) { return; }

    let index = 0;
    function next() {
        // Fin de la liste
        if (index >= cards.length) {
            currentUtterance = null;
            return;
        }

        const card = cards[index];
        // Récupère le texte
        const text = card.innerText;
        // Crée la phrase
        const utterance = new SpeechSynthesisUtterance(text);
        // Langue
        utterance.lang = "sk-SK";
        // Vitesse normale
        utterance.rate = 0.9;
        // Voix
        const voice = findSlovakVoice();

        if (voice) {
            utterance.voice = voice;
        }

        // Une fois la phrase terminée,
        // passe à la suivante
        utterance.onend =
            function() {
                index++;
                // Petite pause entre les phrases
                setTimeout(next, 250);
            };

        currentUtterance = utterance;
        window.speechSynthesis.speak(utterance);
    }
    next();
}


// ==========================================================================
// Afficher / masquer les traductions
// ==========================================================================

/*
 * Masque ou affiche tous les éléments
 * blockquote utilisés comme traductions.
 *
 * Markdown :
 *     > Bonjour, comment allez-vous?
 * devient :
 *     <blockquote>
 *         <p>Bonjour, comment allez-vous?</p>
 *     </blockquote>
 */

function toggleAllTranslations() {
    translationsVisible = !translationsVisible;
    const blockquotes = document.querySelectorAll(".audio-translation");
    blockquotes.forEach(
        blockquote => {
            if (translationsVisible) {
                blockquote.classList.remove("hidden-translation");
            } else {
                blockquote.classList.add("hidden-translation");
            }
        }
    );
}

function toggleTranslation(element) {
    if (element.classList.contains("hidden-translation")) {
        element.classList.remove("hidden-translation");
    }
    else {
        element.classList.add("hidden-translation");
    }
}


// ==========================================================================
// Recherche
// ==========================================================================

/*
 * Filtre les phrases audio en fonction
 * du contenu de la barre de recherche.
 *
 * La recherche porte sur :
 *
 * - Le texte slovaque
 * - La traduction
 */

function searchContent() {
    const searchInput = document.getElementById("search");
    if (!searchInput) {
        return;
    }

    const query = searchInput.value.toLowerCase().trim();
    const cards = document.querySelectorAll(".audio-card");

    cards.forEach(
        card => {
            const text = card.innerText.toLowerCase();
            if (!query || text.includes(query)) {
                card.classList.remove("search-hidden");
            } else {
                card.classList.add("search-hidden");
            }
        }
    );
}

// ==========================================================================
// ==========================================================================
// Vitesse de lecture — réglable et persistée (carte "Vitesse de lecture"
// dans l'onglet Pratique, voir app.js). Seul initializeSpeakableElements()
// (nos éléments .speakable) en tient compte ; les autres fonctionnalités
// de ce fichier (audio-card, translate-table...) viennent du projet mémo
// et ne sont pas utilisées ici — laissées telles quelles.
// ==========================================================================

const TTS_RATE_KEY = "carnet-tts-rate";

function getSpeakableRate() {
    const stored = parseFloat(localStorage.getItem(TTS_RATE_KEY));
    return Number.isFinite(stored) && stored >= 0.4 && stored <= 1.2 ? stored : 0.9;
}

// ==========================================================================
// Initialisation des éléments de classe speakable
// ==========================================================================

/*
 * Ajoute un événément onclick sur tous les éléments
 * de classe "speakable" permettant d'écouter le
 * contenu par synthès vocale
 */

function initializeSpeakableElements() {
    const elements = document.querySelectorAll(".speakable");
    elements.forEach(
        element => {
            element.title = slovakVoiceAvailable
                ? "cliquer pour écouter"
                : "Aucune voix slovaque disponible";
            element.addEventListener(
                "click",
                function() {
                    const text = this.textContent.trim();
                    if (text) {
                        speak(text, getSpeakableRate());
                    }
                }
            )
        }
    )
}

// ==========================================================================
// Initialisation des translate-tables
// ==========================================================================

/*
 * Vérifie si un texte d'en-tête désigne la colonne slovaque.
 *
 * Normalise le texte (accents retirés, tout ce qui n'est pas
 * une lettre a-z retiré) puis vérifie s'il correspond à "sk"
 * ou contient une racine "slovak"/"sloven". Alignée avec la
 * détection de smd2html.py (SLOVAK_HEADERS / is_slovak_header),
 * pour couvrir "Slovenský", "Slovenská", "Slovenské",
 * "slovakština", etc.
 */

function isSlovakHeader(rawText) {
    const text = rawText
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");

    if (text === "sk") { return true; }
    return ["slovak", "slovaqu", "sloven"].some(root => text.includes(root));
}

/*
 * Ajoute un événément onclick sur tous les éléments
 * des colonnes ayant pour header un des mots-clefs
 */

function initializeTranslateTables() {
    const tables = document.querySelectorAll(".translate-table");
    tables.forEach(table => {
        const firstRow = table.rows[0];
        if (!firstRow) return;
        let column = -1;

        [...firstRow.cells].forEach((cell, index) => {
            if (isSlovakHeader(cell.textContent)) { column = index; }
        });
        if (column < 0) return;

        [...table.rows].slice(1).forEach(row => {
            if (row.cells.length <= column) return;
            row.cells[column].classList.add("speakable");
        });
    });
}



// ==========================================================================
// Initialisation des audio-cards
// ==========================================================================

/*
 * Ajoute des boutons pour écouter/écouter lentement/voir la traduction
 */

function initializeAudioCards() {
    const cards = document.querySelectorAll(".audio-card");
    cards.forEach(card => {
        // Rendre le "audio-text" cliquable (écoute)
        const text = card.querySelector(".audio-text");
        if (!text) return;
        text.onclick = () => speak(text.textContent.trim(), 0.9);
        // Cache la traduction
        const translate = card.querySelector(".audio-translation");
        if (translate) translate.classList.add("hidden-translation");

        const buttons = document.createElement("div");
        buttons.className = "audio-buttons";
        /*
        // Ajouter le bouton écoute
        const play = document.createElement("button");
        play.textContent = "🔊";
        play.title = "Ecouter";
        play.onclick = () => speak(text.textContent.trim(), 0.9);
        buttons.appendChild(play);
        // Ajouter le bouton écoute lente
        const slow = document.createElement("button");
        slow.textContent = "🐢";
        slow.title = "Ecouter lentement";
        slow.onclick = () => speak(text.textContent.trim(), 0.65);
        buttons.appendChild(slow);
        */
        if (translate) {
            // Ajouter le bouton afficher la traduction
            const toggle = document.createElement("button");
            toggle.textContent = "👀";
            toggle.title = "Afficher/Masquer la traduction";
            toggle.onclick = () => {
              toggleTranslation(translate);
            }
            buttons.appendChild(toggle);
        }
        card.appendChild(buttons);
    });
}

// ==========================================================================
// Initialisation des voix
// ==========================================================================

/*
 * Sur certains navigateurs, notamment Android,
 * la liste des voix n'est disponible qu'un peu
 * après le chargement de la page.
 *
 * L'événement voiceschanged permet de récupérer
 * la liste dès qu'elle est disponible.
 */

function updateTtsAvailability() {
    selectedVoice = findSlovakVoice();
    slovakVoiceAvailable = !!selectedVoice;

    // Grise visuellement les éléments TTS quand aucune voix
    // slovaque n'est disponible, pour que ce soit clair
    // avant même de cliquer.
    const elements = document.querySelectorAll(".audio-buttons button, .speakable");
    elements.forEach(
        element => {
            if (slovakVoiceAvailable) {
                element.style.opacity = "";
                element.style.cursor = "";
                element.title = element.classList.contains("speakable")
                    ? "cliquer pour écouter"
                    : element.title;
            } else {
                element.style.opacity = "0.4";
                element.style.cursor = "not-allowed";
                element.title = "Aucune voix slovaque disponible";
            }
        }
    );
}

function initializeSpeechSynthesis() {
    if (!("speechSynthesis" in window)) {
        return;
    }
    updateTtsAvailability();
    // Sur certains navigateurs (notamment Android), la liste
    // des voix n'arrive qu'après le chargement initial.
    window.speechSynthesis.addEventListener(
            "voiceschanged",
            updateTtsAvailability
        );
}


// ==========================================================================
// Lancement
// ==========================================================================
document.addEventListener(
    "DOMContentLoaded",
    function() {
        initializeSpeechSynthesis();
        initializeTranslateTables();
        initializeAudioCards();
        initializeSpeakableElements();
        toggleAllTranslations();
        // Les boutons des audio-cards sont créés après le premier
        // appel à updateTtsAvailability() : on la relance pour
        // qu'ils héritent bien de l'état (grisés ou non).
        updateTtsAvailability();
    }
)
