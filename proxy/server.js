const express = require('express');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

app.get('/image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url');
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
      }
    });

    if (!response.ok) {
      return res.status(500).send('Image fetch failed');
    }

    res.setHeader('Content-Type', response.headers.get('content-type'));
    response.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Proxy error');
  }
});

app.listen(3000, () => {
  console.log('✅ Proxy immagini attivo su http://localhost:3000');
});
