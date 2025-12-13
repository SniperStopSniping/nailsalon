-- Add owner name and phone fields to salon table
ALTER TABLE salon ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE salon ADD COLUMN IF NOT EXISTS owner_phone TEXT;
