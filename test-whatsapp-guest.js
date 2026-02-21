import axios from 'axios';

/**
 * CLI Test Script for WhatsApp/Guest Entry Layer
 * Usage: node test-whatsapp-guest.js [query] [institutionCode]
 */

const BASE_URL = 'http://localhost:5000/api/doubts';

async function testGuestDoubt(query = 'What is Newton second law?', institutionCode = 'ETA_DEMO_INST') {
    console.log(`\n🚀 Testing WhatsApp Guest Layer...`);
    console.log(`📝 Query: "${query}"`);
    console.log(`🏛️ Institution: "${institutionCode}"`);
    console.log(`--------------------------------------------------`);

    try {
        const response = await axios.post(`${BASE_URL}/whatsapp-guest`, {
            query,
            institutionCode,
            guestId: 'whatsapp_test_123'
        });

        if (response.data.success) {
            console.log(`✅ SUCCESS\n`);
            console.log(response.data.answer);
            console.log(`\n--------------------------------------------------`);
            console.log(`📊 Source: ${response.data.source}`);
        } else {
            console.log(`❌ FAILED:`, response.data.message);
        }
    } catch (error) {
        console.error(`❌ ERROR:`, error.response?.data?.answer || error.message);
    }
}

// Running the test
const args = process.argv.slice(2);
testGuestDoubt(args[0], args[1]);
