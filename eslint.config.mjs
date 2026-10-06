import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Flat config ESLint.
 *
 * `eslint-config-next@16` sudah mengekspor flat config secara native, jadi
 * `FlatCompat` dari `@eslint/eslintrc` TIDAK dipakai. Versi lama (Next 14/15)
 * memang butuh `compat.extends(...)`, dan mencampurkannya dengan konfigurasi
 * di sini membuat ESLint gagal start dengan
 * "Converting circular structure to JSON".
 */
const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Prefix `_` menandai argumen yang sengaja tidak dipakai.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    /**
     * Skrip di `scripts/` adalah CommonJS murni dan SENGAJA begitu.
     *
     * Tugasnya membaca bundel CommonJS milik nsfwjs
     * (`node_modules/nsfwjs/dist/models/.../*.min.js`) secara langsung.
     * `require()` bukan gaya yang salah di sini — justru itu satu-satunya cara
     * memuat bundel UMD itu apa adanya, tanpa mengubahnya lebih dulu.
     *
     * Skrip ini bukan bagian dari bundle aplikasi: tidak pernah masuk ke
     * `next build`, dan tidak pernah dieksekusi di browser.
     */
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;