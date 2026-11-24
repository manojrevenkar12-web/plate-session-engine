import "@fontsource/overpass/400.css";
import "@fontsource/overpass/700.css";
import "@fontsource/overpass-mono/600.css";
import "../src/shared/theme/tokens.css";
import "../src/shared/theme/global.css";
import type { Preview } from "@storybook/vue3-vite";

const preview: Preview = { parameters: { layout: "padded" } };
export default preview;
