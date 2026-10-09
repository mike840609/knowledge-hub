import { expect, type Locator } from "@playwright/test";

/**
 * A `SelectMenu` is a button and a list that exists only while open, so the native element's
 * `selectOption`, `toHaveValue` and `locator("option")` do not reach it. These say the same three things.
 * The field and its rows carry `data-value` for this.
 */
export async function chooseOption(field: Locator, value: string) {
  await field.click();
  await field.page().locator(`[role="option"][data-value="${value}"]`).click();
}

export async function expectChosen(field: Locator, value: string) {
  await expect(field).toHaveAttribute("data-value", value);
}

/** Opens the list, reads its rows in order, and closes it again without choosing. */
export async function expectOptions(field: Locator, labels: string[]) {
  await field.click();
  await expect(field.page().getByRole("option")).toHaveText(labels);
  await field.page().keyboard.press("Escape");
}
