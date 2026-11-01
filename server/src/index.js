import 'dotenv/config';
import './db.js';
import app from './app.js';
const port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`Daddy's Pizza API listening on http://localhost:${port}`));
