/**
 * Self-hosted fonts for the theme system. Each theme selects a family via the
 * --font-sans / --font-mono CSS variables; all families are bundled through
 * Vite (woff2 emitted to /assets) so no request ever leaves for a font CDN.
 * This keeps the self-host and privacy guarantees intact.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/exo-2';
import '@fontsource-variable/fira-code';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/sora';
import '@fontsource/azeret-mono/400.css';
import '@fontsource/azeret-mono/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
