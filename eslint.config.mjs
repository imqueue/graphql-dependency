import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [
    ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
        },

        languageOptions: {
            globals: {
                ...globals.node,
            },

            parser: tsParser,
        },

        rules: {
            "max-len": ["error", {
                code: 80,
            }],

            "new-parens": "error",
            "no-caller": "error",
            "no-cond-assign": ["error", "always"],

            "no-multiple-empty-lines": ["off", {
                max: 1,
            }],

            quotes: ["error", "single", {
                avoidEscape: true,
            }],

            "arrow-parens": ["off", "always"],
            "no-bitwise": "off",
            "sort-keys": "off",
            "no-console": "off",
            "max-classes-per-file": "off",
            "no-unused-expressions": "off",
            "@typescript-eslint/interface-name-prefix": "off",
            "comma-dangle": ["error", "always-multiline"],
            "@typescript-eslint/no-namespace": "off",
            "@typescript-eslint/no-var-requires": "off",
            "@typescript-eslint/no-extraneous-class": "off",
        },
    },
];