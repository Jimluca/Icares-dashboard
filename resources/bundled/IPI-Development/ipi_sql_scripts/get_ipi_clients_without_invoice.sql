select
    u.id as `user id`,
	convert(substr(u.notes, (instr(u.notes,'<IPIFacNr>') + 10), instr(u.notes,'</IPIFacNr>') - 10 - instr(u.notes,'<IPIFacNr>')), UNSIGNED) as `IPIFacNr`,
    u.firstname as `voornaam`,
    u.lastname as `achternaam`,
    u.email as `email`,
    o.name as `organisatie`
from
    users u
    join organizations o on o.id = u.organization_id
where
    u.organization_id
in
(
    select
       id
    from
    (
        select
            id,
            substr(notes, (instr(notes,'<IPIPrice>') + 10), instr(notes,'</IPIPrice>') - 10 - instr(notes,'<IPIPrice>')) as `IPIPrice`
        from
            organizations o
        group by id
        having `IPIPrice` != ''
    ) as xxx
)
and u.role = 'client'
and u.created_at > o.license_start_date
group by u.id
having `IPIFacNr` = 0