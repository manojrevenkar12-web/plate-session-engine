import type { Meta, StoryObj } from "@storybook/vue3-vite";
import PlateChip from "./PlateChip.vue";

const meta: Meta<typeof PlateChip> = { title: "Shared/PlateChip", component: PlateChip };
export default meta;
type Story = StoryObj<typeof PlateChip>;

export const AsRead: Story = { args: { plate: "MAB1234" } };
export const LookalikeMisread: Story = { args: { plate: "MA81234", reference: "MAB1234" } };
export const DroppedCharacter: Story = { args: { plate: "MAB124", reference: "MAB1234" } };
export const Austrian: Story = { args: { plate: "GU123AB", country: "A" } };
export const Small: Story = { args: { plate: "EDDB20Y8", reference: "EDDB2088", size: "s" } };
