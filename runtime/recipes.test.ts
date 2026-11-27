import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getStarterRecipe, listStarterRecipes, validateStarterRecipes } from "@ade/blueprints";

describe("starter recipes", () => {
	it("ships valid task-shaped starter recipes referencing valid blueprints", () => {
		const recipes = listStarterRecipes();
		assert.ok(recipes.length >= 5);
		const validation = validateStarterRecipes();
		assert.equal(validation.valid, true, validation.errors.join("; "));
	});

	it("looks up recipes by id", () => {
		const bugRepro = getStarterRecipe("bug-repro");
		assert.ok(bugRepro);
		assert.equal(bugRepro.category, "bugs");
		assert.equal(bugRepro.blueprintId, "automated-factory");
		assert.equal(getStarterRecipe("nonexistent"), undefined);
	});
});
