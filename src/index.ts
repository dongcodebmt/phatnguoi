import mongoose from 'mongoose';
import { JobsService } from '@/services';
import { MONGO_URI } from './constants/config';

(async () => {
    mongoose.connect(MONGO_URI).then(async () => {
        console.log('🚀 Connected to MongoDB');

        const jobs = new JobsService();
        await jobs.upsertDailyScheduler();
    });
})();
