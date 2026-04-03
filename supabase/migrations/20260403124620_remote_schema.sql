alter table "public"."customer_sequence" drop constraint "customer_sequence_start_min_when_unbounded_end";

alter table "public"."customer_sequence" alter column "number_format" drop default;


