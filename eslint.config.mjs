// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Regras de fronteira: a mensagem explica o "porque", nao so o "nao pode".
 */
const CROSS_MODULE_MESSAGE =
  'Importe outro modulo pela API publica (ex.: `../orders`), nunca por dentro (`../orders/orders.service`).';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'generated/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
    },
    settings: {
      // Sem isto o resolver so enxerga .js e nao resolve os imports .ts —
      // as regras de fronteira ficam silenciosas (falso "esta tudo certo").
      'import/resolver': {
        node: { extensions: ['.js', '.json', '.ts', '.d.ts'] },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'import/order': [
        'error',
        {
          groups: [
            ['builtin', 'external'],
            'internal',
            ['parent', 'sibling', 'index'],
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      // Camadas: infra existe PARA os modulos de negocio, nunca o contrario.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/infra',
              from: './src/modules',
              message:
                'infra/ e a camada de baixo (Prisma, config): ela nao pode depender de modules/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variableLike',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],
    },
  },
  {
    // Arquivos na raiz de um modulo: `../<outro-modulo>/<interno>`.
    files: ['src/modules/*/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^\\.\\./[^./][^/]*/', message: CROSS_MODULE_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    // Um nivel mais fundo (dto/, entities/): `../../<outro-modulo>/<interno>`.
    files: ['src/modules/*/*/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./\\.\\./[^./][^/]*/',
              message: CROSS_MODULE_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
