-- Add %YYYYMM% and %YYMM% to the label prefix date-token vocabulary (UTC M/Y/D).
-- Mirrors the expansion lib/sequence.ts#interpolateLabelPrefixDateTokens performs in the app.
-- Re-create customer_sequence_cam1_data_value_regex (defined in 20260402130000) so Camera-1
-- log matching recognizes the new tokens too.

create or replace function public.customer_sequence_cam1_data_value_regex(
  p_label_prefix text,
  p_number_format text
)
returns text
language plpgsql
immutable
as $$
declare
  body text;
  n integer;
begin
  body := coalesce(p_label_prefix, '');
  body := replace(body, '%MMYYDD%', chr(1));
  body := replace(body, '%YYYYMMDD%', chr(2));
  body := replace(body, '%MMYY%', chr(7));
  body := replace(body, '%DDMM%', chr(8));
  body := replace(body, '%YYYYMM%', chr(9));
  body := replace(body, '%YYMM%', chr(10));
  body := replace(body, '%YYYY%', chr(3));
  body := replace(body, '%MM%', chr(4));
  body := replace(body, '%DD%', chr(5));
  body := replace(body, '%YY%', chr(6));
  body := regexp_replace(body, '([.+*?^$()[\]{}|\\])', E'\\\1', 'g');
  body := replace(body, chr(1), E'\\d{6}');
  body := replace(body, chr(2), E'\\d{8}');
  body := replace(body, chr(7), E'\\d{4}');
  body := replace(body, chr(8), E'\\d{4}');
  body := replace(body, chr(9), E'\\d{6}');
  body := replace(body, chr(10), E'\\d{4}');
  body := replace(body, chr(3), E'\\d{4}');
  body := replace(body, chr(4), E'\\d{2}');
  body := replace(body, chr(5), E'\\d{2}');
  body := replace(body, chr(6), E'\\d{2}');

  n := length(coalesce(nullif(trim(p_number_format), ''), ''));
  if n <= 0 then
    return '^' || body || '$';
  end if;
  return '^' || body || '\d{' || n::text || '}$';
end;
$$;

comment on function public.customer_sequence_cam1_data_value_regex(text, text) is
  'Camera-1 label match regex: expands M/Y/D tokens (%MMYYDD%, %YYYYMMDD%, %MMYY%, %DDMM%, %YYYYMM%, %YYMM%, %YYYY%, %MM%, %DD%, %YY%) to digit classes; escapes literals; appends fixed-width sequence digits.';
