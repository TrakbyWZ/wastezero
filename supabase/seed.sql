-- Seed data for local/reset. Add INSERT statements as needed.

-- Allow-listed users for OTP login (no self-registration).
INSERT INTO public.users (email, display_name, is_admin, is_active)
VALUES ('dsouzae03@gmail.com', 'E DSouza', true, true),
    ('mdancy@wastezero.com', 'Mark Dancy', false, true),
    ('tcannon@wastezero.com', 'Todd Cannon',false, true),
    ('branda@wastezero.com', 'Brian Randa', false, true),
    ('mmacomber@wastezero.com', 'Megan Macomber', false, true),
    ('bchasse@wastezero.com', 'Brian Chasse', false, true);

INSERT INTO public.customer (customer_num, customer_description)
VALUES ('JADO', 'JADO'),
        ('GREENEARTH', 'Green Earth'),
        ('EVERGREEN', 'Evergreen'),
        ('UCPNB', 'UCPNB'),
        ('PINK', 'PINK');

INSERT INTO public.customer_sequence (customer_id, label_prefix, number_format, start_seq, end_seq, offset_sequence, is_default)
SELECT c.id,    
    CASE 
        WHEN c.customer_num='JADO' THEN 'R002C'
        WHEN c.customer_num='GREENEARTH' THEN 'R003C'
        WHEN c.customer_num='EVERGREEN' THEN 'R005C'
        WHEN c.customer_num='UCPNB' THEN 'R006C'
        WHEN c.customer_num='PINK' THEN 'R007C'
    END as label_prefix,
    '0000000' as number_format,
    1 as start_seq,
    null as end_seq,
    1 as offset_sequence,
    true as is_default
FROM public.customer c;

INSERT INTO public.batch (customer_id, customer_sequence_id, start_sequence, end_sequence, offset_sequence, label_count, start_time, end_time, filename)
SELECT 
    c.id as customer_id,
    cs.id as customer_sequence_id,
    1 as start_sequence,
    1000000 as end_sequence,
    cs.offset_sequence as offset_sequence,
    1000000 as label_count,
    now() as start_time,
    now() as end_time,
    c.customer_num || '_' || to_char(now(), 'YYYYMMDD_HH24MISS') || '.csv' as filename
FROM public.customer c
INNER JOIN public.customer_sequence cs ON c.id = cs.customer_id;


