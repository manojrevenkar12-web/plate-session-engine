import type { Meta, StoryObj } from "@storybook/vue3-vite";
import States from "./States.vue";

const meta: Meta<typeof States> = { title: "Shared/States", component: States };
export default meta;
type Story = StoryObj<typeof States>;

export const Loading: Story = { args: { kind: "loading" } };
export const LoadError: Story = { args: { kind: "error", message: "The report did not load (HTTP 404)." } };
export const Empty: Story = {
  args: { kind: "empty", title: "The held-out car parks have not been run" },
  render: (args) => ({ components: { States }, setup: () => ({ args }), template: '<States v-bind="args">It runs once, after the development gates pass.</States>' }),
};
