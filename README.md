# Mis finanzas

Dashboard personal estático (Chart.js). Los datos están en `datos/finanzas.enc.json`, cifrados con AES-256-GCM
(clave derivada con PBKDF2-SHA256, 600.000 iteraciones); la página los descifra en el navegador con la contraseña.
El código que genera los datos y los datos en claro no están en este repositorio.
