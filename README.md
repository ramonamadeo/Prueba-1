# Rotacion de Potreros

Proyecto base para evolucionar el HTML `rotacion_potreros_v6.html` como app local con Vite.

## Requisitos

- Node.js 22+
- npm 10+

## Arranque rapido

```bash
npm install
npm run dev
```

Luego abre la URL que te muestre Vite, normalmente `http://localhost:5173`.

## Scripts

- `npm run dev`: servidor local para desarrollo
- `npm run build`: genera la version lista para publicar en `dist/`
- `npm run preview`: levanta una vista previa del build

## Estructura

- `index.html`: shell principal de la app
- `src/main.js`: logica de carga, render y simulacion
- `src/styles.css`: estilos de la interfaz

## Siguientes mejoras sugeridas

- separar la logica del parser KML y Excel en modulos
- extraer componentes visuales del mapa y panel lateral
- agregar datos de ejemplo para pruebas rapidas
- incorporar validaciones y mensajes de error mas guiados
