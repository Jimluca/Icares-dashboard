select
    substr(u.notes, (instr(u.notes,'<IPIFacNr>') + 10), instr(u.notes,'</IPIFacNr>') - 10 - instr(u.notes,'<IPIFacNr>')) as `IPIFacNr`,
    (1.21 * convert(substr(o.notes, (instr(o.notes,'<IPIPrice>') + 10), instr(o.notes,'</IPIPrice>') - 10 - instr(o.notes,'<IPIPrice>')), DECIMAL)) as `IPIPrice`,
    u.id as `user id`,
	convert(substr(u.notes, (instr(u.notes,'<IPIFacDate>') + 12), instr(u.notes,'</IPIFacDate>') - 12 - instr(u.notes,'<IPIFacDate>')), DATE) as `IPIFacDate`,
    IF(NOW() > date_add(substr(u.notes, (instr(u.notes,'<IPIFacDate>') + 12), instr(u.notes,'</IPIFacDate>') - 12 - instr(u.notes,'<IPIFacDate>')), INTERVAL 8 DAY), "Payment date passed", "Still time to pay") as `ToPayOrNotToPay`,
    substr(u.notes, (instr(u.notes,'<IPIFacStatus>') + 14), instr(u.notes,'</IPIFacStatus>') - 14 - instr(u.notes,'<IPIFacStatus>')) as `IPIFacStatus`,
    u.firstname as `voornaam`,
    u.lastname as `achternaam`,
    u.email as `email`,
    o.id as `org-id`,
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
        having `IPIPrice` != ""
    ) as xxx
)
and u.role = 'client'
and u.created_at > o.license_start_date
group by u.id
having `IPIFacDate` != 0 AND `IPIFacStatus` = 'OPEN' -- AND `org-id` = 679 -- AND `IPIFacStatus` = 'OPEN' -- AND `IPIFacStatus` = 'OPEN' -- `org-id` = 108 -- AND `org-id` = 711 --
order by `IPIFacNr` desc