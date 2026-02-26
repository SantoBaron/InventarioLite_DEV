# Changelog InventarioLite

## Modo SAGE X3

- Se añadieron los botones **Cargar base SAGE (CSV)**, **Aplicar permitir 0** y **Exportar CSV SAGE** en la cabecera y en el menú móvil.
- Se añadió un panel de estado SAGE con: SESNUM detectada, número de INVNUM, líneas S base y líneas S nuevas.
- `sageUsesLoc` se detecta con el porcentaje de líneas S con `LOC` informado (se considera que usa ubicación cuando está relleno en al menos el 60%).
- Durante el conteo se actualizan en memoria las columnas `QTYPCUNEW` (col. 6) y `ZERSTOFLG` (col. 8) de las líneas S mapeadas.
- La acción **Aplicar permitir 0** deja no tocadas con `QTYPCUNEW=0` y `ZERSTOFLG=2`, y las tocadas con `ZERSTOFLG=1`.
- En alta manual, si SAGE usa LOC y no hay coincidencia exacta por ubicación, se intenta casar por artículo/lote/sublote cuando hay una única línea posible (se marca como encontrada en verde).
