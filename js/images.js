/*
 * Prepara fotos antes de guardar: reduz o tamanho (lado maior até 1000 px) e
 * converte para JPEG, para o catálogo ficar leve mesmo com fotos de celular.
 */
(function (root) {
  'use strict';

  async function loadSource(file) {
    if (typeof root.createImageBitmap === 'function') {
      try {
        return await root.createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        /* tenta o jeito antigo abaixo */
      }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não consegui abrir essa imagem. Tente um JPG ou PNG.'));
      };
      img.src = url;
    });
  }

  /** Devolve { blob, dataUrl, width, height } com a foto já reduzida. */
  async function prepare(file, opts) {
    const max = (opts && opts.max) || 1000;
    const quality = (opts && opts.quality) || 0.8;
    if (!file || !/^image\//.test(file.type || '')) {
      throw new Error('Escolha um arquivo de imagem (JPG, PNG ou WebP).');
    }
    if (file.size > 30 * 1024 * 1024) throw new Error('Essa imagem é grande demais (limite de 30 MB).');

    const src = await loadSource(file);
    const scale = Math.min(1, max / Math.max(src.width, src.height));
    const width = Math.max(1, Math.round(src.width * scale));
    const height = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // fundo branco para PNG com transparência
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(src, 0, 0, width, height);
    if (typeof src.close === 'function') src.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Não consegui preparar essa imagem.');
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Não consegui ler a imagem.'));
      r.readAsDataURL(blob);
    });
    return { blob, dataUrl, width, height };
  }

  root.Images = { prepare };
})(typeof self !== 'undefined' ? self : this);
