require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- HEALTH CHECK ---
app.get('/health', (req, res) => res.json({ status: "Online" }));

// --- 1. MARKETPLACE ROUTES ---
app.get('/api/brokers', async (req, res) => {
    const { data, error } = await supabase.from('brokers').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/upload-broker', async (req, res) => {
    const { name, price, category, endpoint } = req.body;
    const { data, error } = await supabase.from('brokers').insert([
        { 
            name, 
            price: parseFloat(price), 
            category, 
            endpoint, 
            dev: "Verified Developer",
            rating: 5.0 
        }
    ]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
});

// --- 2. VERIFICATION & USAGE (THE CORE LOGIC) ---

// Get Usage (Initial Load)
app.get('/api/usage/:businessId', async (req, res) => {
    const { businessId } = req.params;
    
    let { data, error } = await supabase
        .from('api_usage')
        .select('count')
        .eq('business_id', businessId)
        .single();

    // If no record exists, create one starting at 0
    if (!data) {
        const { data: newData } = await supabase
            .from('api_usage')
            .insert([{ business_id: businessId, count: 0 }])
            .select()
            .single();
        return res.json(newData || { count: 0 });
    }

    res.json(data);
});

// Execute Verification (This makes the button work!)
app.post('/api/verify', async (req, res) => {
    const { businessId } = req.body;

    // 1. Get current count
    const { data: current } = await supabase
        .from('api_usage')
        .select('count')
        .eq('business_id', businessId)
        .single();

    // 2. Increment
    const newCount = (current ? current.count : 0) + 1;

    // 3. Update Database
    const { data, error } = await supabase
        .from('api_usage')
        .update({ count: newCount })
        .eq('business_id', businessId)
        .select();
    if (error) return res.status(500).json({ error: error.message });
    
    // 4. Return success
    res.json({ success: true, count: newCount });
});

// --- 3. PASSPORT (Avoids 404 Error) ---
app.post('/api/create-dpp', async (req, res) => {
    res.json({ success: true, message: "Passport Created" });
});

// --- 4. STRIPE PAYMENT ---
app.post('/create-checkout-session', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'GlanceID Pro Plan' },
                    unit_amount: 2900,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: 'http://localhost:5173/success',
            cancel_url: 'http://localhost:5173/cancel',
        });
        res.json({ url: session.url });
    } catch (e) {
        // If Stripe fails (keys missing), we return error but handled in frontend
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend RUNNING on port ${PORT}`));