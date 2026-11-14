import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    // Imported drawing code is covered by SVG renderer tests, not React lint rules.
    ignores: ['.next/**', 'out/**', 'build/**', 'node_modules/**', 'next-env.d.ts',
      'components/agent-city/renderer.js', 'Isometric Campus.html'],
  },
];

export default config;
