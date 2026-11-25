select
   xxx.id `Organization id`,
   xxx.name `IPI organisatie naam`,
   xxx.license_start_date `IPI licentie startdatum`,
   xxx.license_duration `IPI licentie duur (maanden)`,
   xxx.`Debit Number` `Debit Number`,
   xxx.`IPIPrice` `IPI Price`,
   xxx.`Factuur richten aan`,
   xxx.`Factuur email adres`
from
(
    select
        id,
        name,
        license_start_date,
        license_duration,
        substr(notes, (instr(notes,'<DebNr>') + 7), instr(notes,'</DebNr>') - 7 - instr(notes,'<DebNr>')) as `Debit Number`,
        substr(notes, (instr(notes,'<IPIPrice>') + 10), instr(notes,'</IPIPrice>') - 10 - instr(notes,'<IPIPrice>')) as `IPIPrice`,
        billing_contact_person `Factuur richten aan`,
        billing_email `Factuur email adres`
    from
        organizations o
    group by id
    having `IPIPrice` != ""
) as xxx